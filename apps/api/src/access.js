// One predicate shared by retrieval, document lists, and document detail.
export function accessPredicate(documentAlias = 'd', userParameter = '$1') {
  return `${documentAlias}.deleted_at IS NULL AND EXISTS (SELECT 1 FROM users actor WHERE actor.id=${userParameter} AND actor.deleted_at IS NULL AND (
    ${documentAlias}.visibility='everyone'
    OR (${documentAlias}.visibility='admins' AND actor.role='admin')
    OR (${documentAlias}.visibility='departments' AND EXISTS (
      SELECT 1 FROM document_departments dd JOIN user_departments ud ON ud.department_id=dd.department_id
      WHERE dd.document_id=${documentAlias}.id AND ud.user_id=actor.id
    ))
  ))`;
}
export function canAccessDocument(user, document) {
  if (document.deleted_at || user.deleted_at) return false;
  return document.visibility === 'everyone' || (document.visibility === 'admins' && user.role === 'admin') || (document.visibility === 'departments' && document.departments.some(d => user.departments.includes(d)));
}
