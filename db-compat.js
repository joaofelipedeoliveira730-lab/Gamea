'use strict';

const crypto=require('crypto');

const USER_COLUMNS=['nickname','email','password_hash'];
const USER_COLUMN_SET=new Set(USER_COLUMNS);

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g,'""')}"`;
}

function normalizedName(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

function clip(value, maximumLength) {
  const text=String(value??'');
  const max=Number(maximumLength);
  return Number.isInteger(max)&&max>0 ? text.slice(0,max) : text;
}

function stableInteger(value) {
  const digest=crypto.createHash('sha256').update(String(value)).digest();
  return digest.readUInt32BE(0)&0x7fffffff;
}

function legacyUserValue(column, user) {
  const name=normalizedName(column.column_name);
  const type=String(column.data_type||'').toLowerCase();
  const udt=String(column.udt_name||'').toLowerCase();
  const fallbackEmail=user.email||`${String(user.nickname).replace(/[^a-z0-9]/gi,'').toLowerCase()||'piloto'}@guest.neon-path.invalid`;

  if (column.enum_label!==null&&column.enum_label!==undefined) return column.enum_label;
  if (type==='boolean'||udt==='bool') return false;
  if (type==='json'||type==='jsonb'||udt==='json'||udt==='jsonb') return {};
  if (type.includes('timestamp')||udt==='timestamp'||udt==='timestamptz') return new Date().toISOString();
  if (type==='date'||udt==='date') return new Date().toISOString().slice(0,10);
  if (type.startsWith('time')||udt==='time'||udt==='timetz') return '00:00:00';
  if (type==='interval'||udt==='interval') return '0 seconds';
  if (type==='bytea'||udt==='bytea') return Buffer.alloc(0);
  if (type==='array'||udt.startsWith('_')) return [];
  if (type==='uuid'||udt==='uuid') return crypto.randomUUID();

  const numeric=['smallint','integer','bigint','numeric','decimal','real','double precision','money'];
  if (numeric.includes(type)||['int2','int4','int8','float4','float8','numeric','money'].includes(udt)) {
    if (/(coin|moeda|saldo|balance|bruto)/.test(name)) return 15000;
    if (/(id|codigo|code)/.test(name)) return stableInteger(user.nickname);
    return 0;
  }

  let value=user.nickname;
  if (/(email|mail)/.test(name)) value=fallbackEmail;
  else if (/(password|senha|hash)/.test(name)) value=user.passwordHash;
  else if (/(role|cargo|perfil|permission)/.test(name)) value='player';
  return clip(value,column.character_maximum_length);
}

function buildUserInsert(user, requiredColumns=[]) {
  const emailRequired=requiredColumns.some(column=>column?.column_name==='email');
  const safeNickname=String(user.nickname||'Piloto');
  const email=user.email||(emailRequired?`${safeNickname.replace(/[^a-z0-9]/gi,'').toLowerCase()||'piloto'}@guest.neon-path.invalid`:null);
  const legacy=requiredColumns.filter(column=>column?.column_name&&!USER_COLUMN_SET.has(column.column_name));
  const columns=[...USER_COLUMNS,...legacy.map(column=>column.column_name)];
  const normalizedUser={nickname:safeNickname,email,passwordHash:String(user.passwordHash||'')};
  const values=[safeNickname,email,normalizedUser.passwordHash];
  for (const column of legacy) values.push(legacyUserValue(column,normalizedUser));
  const placeholders=values.map((_,index)=>`$${index+1}`).join(',');
  return {
    sql:`INSERT INTO users(${columns.map(quoteIdentifier).join(',')}) VALUES(${placeholders}) RETURNING id,nickname`,
    values,
    legacyColumns:legacy.map(column=>column.column_name)
  };
}

module.exports={buildUserInsert,legacyUserValue,quoteIdentifier};
