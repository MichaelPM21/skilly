require('dotenv').config();
const express=require('express');
const path=require('path');
const {db,seedIfEmpty,getSettings}=require('./db');
const {migrate}=require('./schema');
const S=require('./security');
const {wrap,authRoutes}=require('./accounts');
const {servicesRoutes}=require('./services');
const {bookingsRoutes}=require('./bookings');
const {paymentsRoutes}=require('./payments');
const {reports}=require('./reports');
if(process.env.SEED_DEMO==='true')seedIfEmpty();
migrate();
function createApp(kind='public') {
  const app=express();app.locals.kind=kind;app.disable('x-powered-by');
  if(process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
    if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
    next();
  });
  app.use(express.json({limit:'8mb'}));app.use(express.urlencoded({extended:false,limit:'20kb'}));app.use(S.auth);
  app.use('/api',(req,res,next)=>{
    try {
      const callback=/^\/payments\/(webpay\/commit|paypal\/capture)$/.test(req.path);
      const expected=kind==='admin'?process.env.ADMIN_URL||'http://localhost:3001':process.env.BASE_URL||'http://localhost:3000';
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!callback) {
        if(req.get('Origin')&&req.get('Origin')!==new URL(expected).origin)S.fail(403,'Origen no autorizado.');
        if(req.get('X-Skilly-Request')!=='1')S.fail(403,'Solicitud no autorizada. Actualiza la página.');
      }
      if(kind==='public'&&req.path.startsWith('/admin'))S.fail(404,'Utiliza la aplicación administrativa.');
      if(kind==='admin'&&!req.path.startsWith('/auth/')&&req.path!=='/config')S.admin(req);
      if(kind==='admin'&&callback)S.fail(404,'Ruta no disponible.');
      next();
    }catch(e){next(e);}
  });
  authRoutes(app);servicesRoutes(app);bookingsRoutes(app);paymentsRoutes(app);require('./governance').routes(app);reports(app);
  app.get('/api/config',(req,res)=>res.json({mailerConfigured:!!(process.env.GMAIL_USER&&process.env.GMAIL_APP_PASSWORD),paypalConfigured:require('./paypal').isConfigured(),webpayEnv:process.env.WEBPAY_ENV||'integration',cancellationRefundPercent:getSettings().default_cancellation_refund_percent,simulatedEnabled:process.env.NODE_ENV!=='production',adminUrl:process.env.ADMIN_URL||'http://localhost:3001',timeZone:'America/Santiago',appKind:kind}));
  app.get('/api/admin/evaluations',wrap((req,res)=>{S.admin(req);res.json(db.prepare('SELECT * FROM evaluations ORDER BY created_at DESC').all().map(e=>({id:e.id,professionalId:e.professional_id,professionalName:e.professional_name,orgName:e.org_name,stars:e.stars,comment:e.comment,createdAt:e.created_at})));}));
  app.use('/api',(req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
  const root=path.join(__dirname,'..');
  // Each app serves a separate HTML entry point; shared assets preserve the design.
  app.get('/',(req,res)=>res.sendFile(path.join(root,kind==='admin'?'admin/index.html':'public/index.html')));
  app.use('/js',express.static(path.join(root,'public/js')));
  app.get('/styles.css',(req,res)=>res.sendFile(path.join(root,'public/styles.css')));
  app.get('/workspace.css',(req,res)=>res.sendFile(path.join(root,'public/workspace.css')));
  app.get('/favicon.ico',(req,res)=>res.status(204).end());
  app.use((err,req,res,next)=>{
    if(res.headersSent)return next(err);
    const status=err.status||400;
    if(!err.status)console.error('[Skilly]',err.message);
    res.status(status).json({error:err.status?err.message:'No se pudo procesar la solicitud. Revisa los datos e inténtalo otra vez.'});
  });
  return app;
}
if(require.main===module) {
  const kind=process.env.APP_KIND==='admin'?'admin':'public';
  const port=kind==='admin'?(process.env.ADMIN_PORT||3001):(process.env.PORT||3000);
  require('./governance').startWorker();
  createApp(kind).listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Skilly ${kind}: http://localhost:${port}`));
}
module.exports={createApp};
