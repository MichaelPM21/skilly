const fs=require('fs');const path=require('path');const {spawnSync}=require('child_process');
const roots=['server','scripts','public/js','tests'];let count=0;
for(const root of roots)for(const entry of fs.readdirSync(root)){if(!entry.endsWith('.js'))continue;const file=path.join(root,entry);const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);count++;}
console.log(`Sintaxis verificada en ${count} archivos JavaScript.`);
