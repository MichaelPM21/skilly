/**
 * Flujo del módulo. Generación de SQL académico y diccionario físico a partir del esquema
 * actual. Escribe scripts y documentación local sin exportar filas de clientes. Los scripts de
 * eliminación deben reservarse para esquemas desechables.
 */

// Read PostgreSQL metadata; never export application rows or credentials.
require('dotenv').config();
const fs=require('node:fs'),path=require('node:path');
const {db}=require('../server/db');
/**
 * Consulta metadatos PostgreSQL y combina restricciones e índices con el SQL inicial para
 * generar scripts académicos y diccionario físico. Escribe estructura y relaciones, nunca filas
 * de negocio; los scripts DROP generados son para bases desechables.
 */
async function exportSchema(){
 const out=path.join(__dirname,'../database/schema-exports');fs.mkdirSync(out,{recursive:true});
 const reports=path.join(__dirname,'../.local/schema-docs');fs.mkdirSync(reports,{recursive:true});
 const sql=fs.readFileSync(path.join(__dirname,'../database/postgres/001-initial.sql'),'utf8');
 const statements=sql.replace(/^--.*$/gm,'').split(';').map(/* Elimina espacios exteriores de cada valor antes de descartar entradas vacías o enviar los datos. */ s=>s.trim()).filter(Boolean);
 const warning='-- PostgreSQL. Scripts académicos para una base DESECHABLE; no ejecutar DROP sobre la base de trabajo.\n';
 /**
  * Escribe UTF-8 en database/schema-exports para archivos SQL o en .local/schema-docs para
  * informes. La extensión determina el destino.
  */
 const write=(file,content)=>fs.writeFileSync(path.join(file.endsWith('.sql')?out:reports,file),content,'utf8');
 const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows.map(/* Extrae r.tablename de cada elemento para formar la lista que necesita esta operación. */ r=>r.tablename);
 const constraints=(await db.query("SELECT c.conname,c.contype,c.conrelid::regclass::text AS table_name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c WHERE c.connamespace=current_schema()::regnamespace ORDER BY c.conrelid::regclass::text,c.conname")).rows;
 const fks=(await db.query("SELECT tc.table_name,kcu.column_name,ccu.table_name AS referenced_table,ccu.column_name AS referenced_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.constraint_schema=ccu.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.constraint_schema=current_schema() ORDER BY tc.table_name,kcu.column_name")).rows;
 write('esquema-completo.sql',warning+sql);
 write('01-tablas.sql',warning+statements.filter(/* Conserva los elementos según la condición s.startsWith('CREATE TABLE'). Se evalúan los datos ya cargados. */ s=>s.startsWith('CREATE TABLE')).map(/* Transforma cada elemento con s.replace(/ PRIMARY KEY/g,'')+';' para construir la colección utilizada por esta operación. */ s=>s.replace(/ PRIMARY KEY/g,'')+';').join('\n\n')+'\n');
 write('02-claves-primarias.sql',warning+constraints.filter(/* Conserva los elementos según la condición c.contype==='p'. Se evalúan los datos ya cargados. */ c=>c.contype==='p').map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ c=>`ALTER TABLE ${c.table_name} ADD CONSTRAINT ${c.conname} ${c.definition};`).join('\n')+'\n');
 write('03-claves-foraneas.sql',warning+statements.filter(/* Conserva los elementos según la condición s.startsWith('ALTER TABLE'). Se evalúan los datos ya cargados. */ s=>s.startsWith('ALTER TABLE')).join(';\n')+';\n');
 write('04-indices.sql',warning+statements.filter(/* Conserva los elementos según la condición /^CREATE (UNIQUE )?INDEX/.test(s). Se evalúan los datos ya cargados. */ s=>/^CREATE (UNIQUE )?INDEX/.test(s)).join(';\n')+';\n');
 write('90-eliminar-claves-foraneas.sql',warning+constraints.filter(/* Conserva los elementos según la condición c.contype==='f'. Se evalúan los datos ya cargados. */ c=>c.contype==='f').map(/* Construye el fragmento de presentación de cada elemento; el resultado se une después para formar la vista. */ c=>`ALTER TABLE ${c.table_name} DROP CONSTRAINT ${c.conname};`).join('\n')+'\n');
 write('99-eliminar-tablas.sql',warning+'DROP TABLE '+tables.join(', ')+' CASCADE;\n');
 let dict='# Diccionario físico — PostgreSQL\n\nGenerado por `npm run db:docs` desde metadatos PostgreSQL. Fechas BIGINT: milisegundos Unix; fechas de agenda TEXT: AAAA-MM-DD; hora TEXT: HH:mm (America/Santiago). Importes de reserva: CLP enteros. JSON se conserva como TEXT para mantener los contratos existentes. Adjuntos: BYTEA.\n';
 let diagram='# Modelo físico — PostgreSQL\n\n```mermaid\nerDiagram\n';
 for(const table of tables){
  const cols=(await db.query('SELECT column_name,udt_name,is_nullable,column_default,is_identity FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position',[table])).rows;
  const pk=constraints.find(/* Busca el primer elemento según la condición c.table_name===table&&c.contype==='p'. Se evalúan los datos ya cargados. */ c=>c.table_name===table&&c.contype==='p')?.definition||'';
  dict+='\n## '+table+'\n\n| Campo | Tipo | Admite NULL | Predeterminado | Clave |\n|---|---|---|---|---|\n';
  diagram+='  '+table+' {\n';
  for(const c of cols){const fk=fks.find(/* Busca el primer elemento según la condición f.table_name===table&&f.column_name===c.column_name. Se evalúan los datos ya cargados. */ f=>f.table_name===table&&f.column_name===c.column_name);const key=pk.includes('('+c.column_name+')')?'PK':fk?'FK':'';dict+='| '+[c.column_name,c.udt_name,c.is_nullable==='YES'?'Sí':'No',c.is_identity==='YES'?'IDENTITY':c.column_default||'—',key+(fk?' → '+fk.referenced_table+'.'+fk.referenced_column:'')].join(' | ')+' |\n';if(key)diagram+='    '+c.udt_name+' '+c.column_name+' '+key+'\n';}
  diagram+='  }\n';
  const indexes=(await db.query('SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename=$1 ORDER BY indexname',[table])).rows;
  dict+='\nÍndices:\n\n'+indexes.map(/* Transforma cada elemento con '- `'+r.indexdef.replace(/ ON [a-z0-9_]+\./,' ON ')+'`' para construir la colección utilizada por esta operación. */ r=>'- `'+r.indexdef.replace(/ ON [a-z0-9_]+\./,' ON ')+'`').join('\n')+'\n';
 }
 for(const f of fks)diagram+='  '+f.referenced_table+' ||--o{ '+f.table_name+' : "'+f.column_name+'"\n';
 write('diccionario.md',dict);write('modelo-fisico.md',diagram+'```\n\n'+tables.length+' tablas; '+fks.length+' claves foráneas declaradas. Las FK opcionales se detallan en el diccionario.\n');
 console.log(tables.length+' tablas y '+fks.length+' relaciones PostgreSQL documentadas.');
}
exportSchema().catch(e=>{
  // Registra el error recibido y conserva el indicador de fallo del script o propaga el error al siguiente manejador.
  console.error(e.message);process.exitCode=1;}).finally(/* Cierra el pool al terminar, tanto en éxito como en error, para no dejar conexiones abiertas. */ ()=>db.close());
