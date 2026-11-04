const {spawn}=require('child_process');
const children=['server/index.js','server/admin.js'].map(file=>spawn(process.execPath,[file],{stdio:'inherit',env:process.env,windowsHide:true}));
function stop(){for(const child of children)child.kill();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
children.forEach(c=>c.on('exit',code=>{if(code){stop();process.exitCode=code;}}));
