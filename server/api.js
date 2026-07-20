/* api.js — notes / folders / images / shares.
 *
 * Authorization rule for the whole file: the caller's identity comes from their
 * session, never from the request body. Any owner_id in client JSON is ignored.
 */
'use strict';

const crypto = require('node:crypto');
const { q, tx } = require('./db');
const hub = require('./hub');
const { merge3 } = require('./merge');

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(6).toString('hex');
}

// ---------------- permissions ----------------
function permFor(user, note) {
  if (!note) return null;
  if (note.owner_id === user.id) return 'owner';
  const s = q.shareFor.get(note.id, user.id);
  return s ? s.perm : null;          // 'read' | 'edit' | null
}
const canRead = p => p === 'owner' || p === 'read' || p === 'edit';
const canEdit = p => p === 'owner' || p === 'edit';

function shapeNote(row, perm, ownerName) {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    content: row.content,
    meta: row.meta ? JSON.parse(row.meta) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rev: row.rev || 0,                // revision counter for live collaboration
    perm: perm,                       // so the UI can go read-only
    sharedBy: ownerName || undefined
  };
}

// ---------------- notes ----------------
function listNotes(user) {
  const own = q.notesOwned.all(user.id).map(r => shapeNote(r, 'owner'));
  const shared = q.notesSharedWith.all(user.id).map(r => shapeNote(r, r.share_perm, r.owner_name));
  return own.concat(shared);
}

function getNote(user, id) {
  const row = q.noteById.get(id);
  const perm = permFor(user, row);
  if (!canRead(perm)) return null;
  const owner = perm === 'owner' ? null : q.userById.get(row.owner_id);
  return shapeNote(row, perm, owner && owner.username);
}

function createNote(user, body) {
  const now = Date.now();
  const id = uid('note');
  q.insertNote.run(
    id, user.id, body.folderId || null,
    String(body.title || '未命名筆記'), String(body.content || ''),
    body.meta ? JSON.stringify(body.meta) : null, now, now);
  return shapeNote(q.noteById.get(id), 'owner');
}

function updateNote(user, id, body) {
  const row = q.noteById.get(id);
  const perm = permFor(user, row);
  if (!canRead(perm)) return { status: 404 };
  if (!canEdit(perm)) return { status: 403, error: '你對這篇筆記只有唯讀權限' };
  // A recipient with edit rights may change content, but must not be able to
  // move someone else's note into their own folder tree.
  const folderId = perm === 'owner' ? (body.folderId || null) : row.folder_id;

  const incoming = String(body.content || '');
  const title = String(body.title || '未命名筆記');
  // Collaborative merge: `baseContent` is the text this client last had in sync
  // with the server. If someone else saved in the meantime (row.content moved on),
  // reconcile the two edits; on a same-line clash this save wins (last-write-wins).
  const base = (body.baseContent != null) ? String(body.baseContent) : row.content;
  const merged = merge3(base, incoming, row.content);

  // Nothing actually changed (a no-op autosave, or a save fully absorbed by the
  // current version): don't bump the revision or wake the other editors.
  if (merged === row.content && title === row.title) {
    return { note: shapeNote(row, perm) };
  }

  const now = Date.now();
  const rev = (row.rev || 0) + 1;
  q.updateNote.run(
    folderId, title, merged,
    body.meta ? JSON.stringify(body.meta) : row.meta, now, rev, id);

  // Let everyone watching the note pull in the authoritative merged text. `by`
  // carries the saver's name so their own client can ignore the echo.
  hub.broadcastUpdate(id, { rev: rev, content: merged, title: title, by: user.username, updatedAt: now });
  return { note: shapeNote(q.noteById.get(id), perm) };
}

// Relay a live caret position to the other people viewing this note. Nothing is
// stored — it is transient presence, gone the moment the editor moves or leaves.
function broadcastCursor(user, id, body) {
  const row = q.noteById.get(id);
  const perm = permFor(user, row);
  if (!canRead(perm)) return { status: 404 };
  const pos = Math.max(0, parseInt(body && body.pos, 10) || 0);
  const end = Math.max(pos, parseInt(body && body.end, 10) || pos);
  hub.broadcastCursor(id, { by: user.username, pos: pos, end: end, ts: Date.now() });
  return { ok: true };
}

function deleteNote(user, id) {
  const row = q.noteById.get(id);
  const perm = permFor(user, row);
  if (!canRead(perm)) return { status: 404 };
  if (perm !== 'owner') return { status: 403, error: '只有擁有者可以刪除筆記' };
  q.deleteNote.run(id);
  return { ok: true };
}

// ---------------- folders ----------------
// Folders are private structure; they are never shared.
function listFolders(user) {
  return q.foldersOf.all(user.id).map(r => ({
    id: r.id, name: r.name, parentId: r.parent_id, createdAt: r.created_at
  }));
}
function createFolder(user, body) {
  const id = uid('fld');
  q.insertFolder.run(id, user.id, String(body.name || '新資料夾'), body.parentId || null, Date.now());
  const r = q.folderById.get(id);
  return { id: r.id, name: r.name, parentId: r.parent_id, createdAt: r.created_at };
}
function updateFolder(user, id, body) {
  const r = q.folderById.get(id);
  if (!r || r.owner_id !== user.id) return { status: 404 };
  q.updateFolder.run(String(body.name || r.name), body.parentId || null, id, user.id);
  const u = q.folderById.get(id);
  return { folder: { id: u.id, name: u.name, parentId: u.parent_id, createdAt: u.created_at } };
}
function deleteFolder(user, id) {
  const r = q.folderById.get(id);
  if (!r || r.owner_id !== user.id) return { status: 404 };
  q.deleteFolder.run(id, user.id);
  return { ok: true };
}

// ---------------- images ----------------
function createImage(user, mime, buf) {
  const id = uid('img');
  q.insertImage.run(id, user.id, String(mime || 'image/png'), buf, null, null, Date.now());
  return { id: id };
}

function getImage(user, id) {
  const row = q.imageById.get(id);
  if (!row) return null;
  if (row.owner_id === user.id) return row;
  // Not the owner: only serve it if some note the caller can read embeds it,
  // either as an image (img:) or as a PDF attachment (pdf:).
  const visible = q.imageVisibleTo.get('img:' + id, user.id, user.id)
              || q.imageVisibleTo.get('pdf:' + id, user.id, user.id);
  return visible ? row : null;
}

function saveImage(user, id, body) {
  const row = q.imageById.get(id);
  if (!row) return { status: 404 };
  // Annotations rewrite pixels — only the owner may do that, even if a recipient
  // has edit rights on a note that happens to embed the image.
  if (row.owner_id !== user.id) return { status: 403, error: '只有圖片擁有者可以標註' };
  const data = Buffer.from(body.data, 'base64');
  const original = body.original ? Buffer.from(body.original, 'base64') : row.original;
  q.updateImage.run(String(body.mime || row.mime), data, original,
    body.shapes ? JSON.stringify(body.shapes) : null, id);
  return { ok: true };
}

function deleteImage(user, id) {
  q.deleteImage.run(id, user.id);
  return { ok: true };
}

// ---------------- shares ----------------
function listShares(user, noteId) {
  const row = q.noteById.get(noteId);
  if (!row || row.owner_id !== user.id) return { status: 404 };
  return {
    shares: q.sharesOfNote.all(noteId).map(s => ({ username: s.username, perm: s.perm }))
  };
}

function addShare(user, noteId, body) {
  const row = q.noteById.get(noteId);
  if (!row || row.owner_id !== user.id) return { status: 404 };
  const perm = body.perm === 'edit' ? 'edit' : 'read';
  const target = q.userByName.get(String(body.username || ''));
  if (!target) return { status: 404, error: '找不到這個帳號' };
  if (target.id === user.id) return { status: 400, error: '不能分享給自己' };
  q.insertShare.run(noteId, target.id, perm, Date.now());
  return { ok: true, username: target.username, perm: perm };
}

function removeShare(user, noteId, username) {
  const row = q.noteById.get(noteId);
  if (!row) return { status: 404 };
  const target = q.userByName.get(String(username || ''));
  if (!target) return { status: 404, error: '找不到這個帳號' };
  // The owner may revoke anyone; a recipient may drop their own share (leave),
  // but may not meddle with anyone else's access.
  const isOwner = row.owner_id === user.id;
  const isSelf = target.id === user.id && !!q.shareFor.get(noteId, user.id);
  if (!isOwner && !isSelf) return { status: 404 };
  q.deleteShare.run(noteId, target.id);
  return { ok: true };
}

// ---------------- admin ----------------
//
// Scope note: an admin manages *accounts*, not content. There is deliberately no
// endpoint here that returns anyone's note text — only counts. Reading a
// colleague's report still requires them to share it.
function adminListUsers(user) {
  return {
    users: q.listUsers.all().map(function (u) {
      return {
        id: u.id, username: u.username, role: u.role,
        disabled: !!u.disabled, createdAt: u.created_at, lastLogin: u.last_login,
        notes: u.notes, folders: u.folders, images: u.images,
        sharedOut: u.shared_out, sharedIn: u.shared_in,
        self: u.id === user.id
      };
    })
  };
}

function adminSetDisabled(user, id, disabled) {
  const target = q.userById.get(Number(id));
  if (!target) return { status: 404, error: '找不到這個帳號' };
  // Guard rails against locking the system out of its own administration.
  if (target.id === user.id) return { status: 400, error: '不能停用自己的帳號' };
  if (disabled && target.role === 'admin' && q.countAdmins.get().n <= 1) {
    return { status: 400, error: '這是最後一個啟用中的管理員，不能停用' };
  }
  // One transaction: a disable that revoked the sessions but failed to set the
  // flag (or the reverse) would leave the account in a half-locked state.
  tx(function () {
    q.setDisabled.run(disabled ? 1 : 0, target.id);
    // Kill their sessions so a disable takes effect now, not when the cookie expires.
    if (disabled) q.deleteSessionsOf.run(target.id);
  }, 'setDisabled');
  return { ok: true, disabled: !!disabled };
}

function adminSetRole(user, id, role) {
  const target = q.userById.get(Number(id));
  if (!target) return { status: 404, error: '找不到這個帳號' };
  if (role !== 'admin' && role !== 'user') return { status: 400, error: '權限值不正確' };
  if (target.id === user.id) return { status: 400, error: '不能更改自己的權限' };
  if (role === 'user' && target.role === 'admin' && q.countAdmins.get().n <= 1) {
    return { status: 400, error: '這是最後一個管理員，不能取消其權限' };
  }
  q.setRole.run(role, target.id);
  return { ok: true, role: role };
}

function adminDeleteUser(user, id) {
  const target = q.userById.get(Number(id));
  if (!target) return { status: 404, error: '找不到這個帳號' };
  if (target.id === user.id) return { status: 400, error: '不能刪除自己的帳號' };
  if (target.role === 'admin' && q.countAdmins.get().n <= 1) {
    return { status: 400, error: '這是最後一個管理員，不能刪除' };
  }
  // Their notes, folders, images and shares go with them (ON DELETE CASCADE).
  tx(function () {
    q.deleteSessionsOf.run(target.id);
    q.deleteUser.run(target.id);
  }, 'deleteUser');
  return { ok: true };
}

module.exports = {
  adminListUsers, adminSetDisabled, adminSetRole, adminDeleteUser,
  listNotes, getNote, createNote, updateNote, deleteNote, broadcastCursor,
  listFolders, createFolder, updateFolder, deleteFolder,
  createImage, getImage, saveImage, deleteImage,
  listShares, addShare, removeShare
};
