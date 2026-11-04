const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');
test('Additive migration preserves legacy profiles, payments, reservations and settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skilly-migration-'));process.env.DB_PATH=path.join(dir,'legacy.db');
 const {db,seedIfEmpty}=require('../server/db');seedIfEmpty();const pro=db.prepare('SELECT * FROM professionals LIMIT 1').get();
 const date=new Date(Date.now()+86400000*30).toISOString().slice(0,10);
 db.prepare("INSERT INTO bookings(id,professional_id,org_email,date,time,amount,status,created_at) VALUES('old',?,'historic@test.cl',?,'11:00',35000,'reservado',?)").run(pro.id,date,Date.now());
 db.prepare("INSERT INTO bookings(id,professional_id,org_email,date,time,amount,status,created_at) VALUES('paid',?,'historic@test.cl',?,'15:00',35000,'pagado',?)").run(pro.id,date,Date.now());
 db.prepare("INSERT INTO payments(id,booking_id,amount,status,created_at) VALUES('oldpay','paid',35000,'pagado',?)").run(Date.now());
 db.prepare('UPDATE settings SET default_cancellation_refund_percent=65,admin_weekly_review_capacity=7 WHERE id=1').run();
 const {migrate}=require('../server/schema');migrate();migrate();
 assert.equal(db.prepare('SELECT COUNT(*) n FROM professionals').get().n,4);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM services').get().n,4);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
 const old=db.prepare("SELECT * FROM bookings WHERE id='old'").get();assert.equal(old.amount,35000);assert.equal(old.status,'solicitado');assert.ok(old.response_deadline>Date.now());assert.equal(old.refund_policy_percent,65);
 assert.ok(db.prepare("SELECT paid_at FROM bookings WHERE id='paid'").get().paid_at);
 assert.equal(db.prepare('SELECT admin_weekly_review_capacity FROM settings').get().admin_weekly_review_capacity,7);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0,'No insecure default or automatic account claims');
 db.close();fs.rmSync(dir,{recursive:true,force:true});
});
