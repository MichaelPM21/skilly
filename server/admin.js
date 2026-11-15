require('./index').start('admin').catch(error=>{console.error('No se pudo iniciar administración:',error.message);require('./db').db.close().finally(()=>{process.exitCode=1;});});
