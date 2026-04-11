const{onDocumentCreated}=require('firebase-functions/v2/firestore');
const{onCall,HttpsError}=require('firebase-functions/v2/https');
const{onSchedule}=require('firebase-functions/v2/scheduler');
const{initializeApp}=require('firebase-admin/app');
const{getMessaging}=require('firebase-admin/messaging');
const{getFirestore,FieldValue}=require('firebase-admin/firestore');
initializeApp();
const db=getFirestore();
const fcm=getMessaging();
const SUPER_EMAIL='sedomem@gmail.com';
const DEFAULT_ICON='https://www.runclubturkiye.com/icon-192.png';
const DEFAULT_BADGE='https://www.runclubturkiye.com/icon-96.png';
const DEFAULT_URL='https://www.runclubturkiye.com/';

async function getAllFcmTokens(){
  const snap=await db.collection('users').where('pushEnabled','==',true).get();
  const tokens=[];
  snap.forEach(doc=>{
    const d=doc.data();
    if(d.fcmToken&&typeof d.fcmToken==='string'&&d.fcmToken.length>20){
      tokens.push({uid:doc.id,token:d.fcmToken});
    }
  });
  console.log(`[FCM] ${tokens.length} aktif token bulundu`);
  return tokens;
}

async function cleanInvalidTokens(invalidTokens){
  if(!invalidTokens||!invalidTokens.length)return;
  const snap=await db.collection('users').where('pushEnabled','==',true).get();
  const batch=db.batch();
  snap.forEach(doc=>{
    if(invalidTokens.includes(doc.data().fcmToken)){
      batch.update(doc.ref,{fcmToken:FieldValue.delete(),pushEnabled:false});
    }
  });
  await batch.commit();
  console.log(`[FCM] ${invalidTokens.length} geçersiz token temizlendi`);
}

async function sendBatch(tokens,title,body,url,iconUrl,imageUrl){
  const results={success:0,failure:0,invalidTokens:[]};
  if(!tokens.length)return results;

  const chunks=[];
  for(let i=0;i<tokens.length;i+=500)chunks.push(tokens.slice(i,i+500));

  for(const chunk of chunks){
    const messages=chunk.map(({token})=>({
      token,
      // Android/iOS için
      notification:{
        title,
        body,
        imageUrl:imageUrl||undefined,
      },
      // Web Push için
      webpush:{
        headers:{'TTL':'86400'},
        notification:{
          title,
          body,
          icon: iconUrl||DEFAULT_ICON,
          badge: DEFAULT_BADGE,
          image: imageUrl||undefined,
          requireInteraction:false,
          vibrate:[200,100,200],
        },
        fcmOptions:{
          link: url||DEFAULT_URL,
        },
      },
      data:{
        url: url||DEFAULT_URL,
        timestamp: String(Date.now()),
      },
    }));

    try{
      const response=await fcm.sendEach(messages);
      results.success+=response.successCount;
      results.failure+=response.failureCount;
      console.log(`[FCM] Chunk: ${response.successCount} başarı, ${response.failureCount} hata`);

      response.responses.forEach((resp,idx)=>{
        if(!resp.success){
          const code=resp.error?.code||'';
          console.warn(`[FCM] Hata - uid:${chunk[idx].uid} code:${code} msg:${resp.error?.message}`);
          if(code==='messaging/registration-token-not-registered'||
             code==='messaging/invalid-registration-token'){
            results.invalidTokens.push(chunk[idx].token);
          }
        }
      });
    }catch(e){
      console.error('[FCM] sendEach hatası:',e.message);
      results.failure+=chunk.length;
    }
  }

  if(results.invalidTokens.length>0){
    await cleanInvalidTokens(results.invalidTokens);
  }
  return results;
}

// ── 1. Ana trigger: pushNotifications koleksiyonu
exports.onPushNotificationCreated=onDocumentCreated(
  {document:'pushNotifications/{docId}',region:'europe-west1'},
  async(event)=>{
    const docId=event.params.docId;
    const data=event.data.data();
    console.log(`[FCM] Tetiklendi: ${docId}`,JSON.stringify(data));

    if(data.status!=='pending'){
      console.log('[FCM] Pending değil, atlandı:',data.status);
      return;
    }

    const ref=db.collection('pushNotifications').doc(docId);
    await ref.update({status:'processing',processedAt:FieldValue.serverTimestamp()});

    try{
      const title=data.title||'RunClubTürkiye';
      const body=data.body||'';
      const url=data.url||DEFAULT_URL;
      const image=data.image||'';

      console.log(`[FCM] Gönderilecek: title="${title}" body="${body}" url="${url}"`);

      const tokens=await getAllFcmTokens();

      if(!tokens.length){
        console.log('[FCM] Kayıtlı kullanıcı yok');
        await ref.update({status:'no_subscribers',completedAt:FieldValue.serverTimestamp()});
        return;
      }

      const results=await sendBatch(tokens,title,body,url,DEFAULT_ICON,image);
      console.log(`[FCM] Tamamlandı: ${results.success} başarı, ${results.failure} hata`);

      await ref.update({
        status:'sent',
        sentCount:results.success,
        failCount:results.failure,
        completedAt:FieldValue.serverTimestamp(),
      });

    }catch(e){
      console.error('[FCM] Genel hata:',e.message,e.stack);
      await ref.update({
        status:'error',
        error:e.message,
        errorAt:FieldValue.serverTimestamp(),
      }).catch(()=>{});
    }
  }
);

// ── 2. Tek kullanıcıya bildirim
exports.sendPushToUser=onCall(
  {region:'europe-west1'},
  async(request)=>{
    if(!request.auth||request.auth.token.email!==SUPER_EMAIL){
      throw new HttpsError('permission-denied','Sadece süper admin.');
    }
    const{targetUid,title,body,url,image}=request.data;
    if(!targetUid||!title||!body)throw new HttpsError('invalid-argument','Eksik parametre.');
    const userDoc=await db.collection('users').doc(targetUid).get();
    if(!userDoc.exists)throw new HttpsError('not-found','Kullanıcı bulunamadı.');
    const token=userDoc.data()?.fcmToken;
    if(!token)throw new HttpsError('not-found','FCM token yok.');
    const results=await sendBatch([{uid:targetUid,token}],title,body,url||DEFAULT_URL,DEFAULT_ICON,image||'');
    return{success:results.success>0,...results};
  }
);

// ── 3. Topic bildirimi
exports.sendPushToTopic=onCall(
  {region:'europe-west1'},
  async(request)=>{
    if(!request.auth||request.auth.token.email!==SUPER_EMAIL){
      throw new HttpsError('permission-denied','Sadece süper admin.');
    }
    const{topic,title,body,url,image}=request.data;
    if(!topic||!title||!body)throw new HttpsError('invalid-argument','Eksik parametre.');
    const msg={
      topic,
      notification:{title,body,imageUrl:image||undefined},
      webpush:{
        notification:{title,body,icon:DEFAULT_ICON,badge:DEFAULT_BADGE,image:image||undefined},
        fcmOptions:{link:url||DEFAULT_URL},
      },
    };
    const msgId=await fcm.send(msg);
    return{success:true,messageId:msgId};
  }
);

// ── 4. Yeni etkinlik bildirimi
exports.onEventApproved=onDocumentCreated(
  {document:'events/{eventId}',region:'europe-west1'},
  async(event)=>{
    const data=event.data.data();
    if(data.status!=='approved')return;
    const title='🏃 Yeni Etkinlik!';
    const body=`${data.title||data.name||'Etkinlik'} — ${data.location||''}`.trim();
    const url=`${DEFAULT_URL}#events/${event.params.eventId}`;
    const tokens=await getAllFcmTokens();
    if(!tokens.length)return;
    const r=await sendBatch(tokens,title,body,url,DEFAULT_ICON,'');
    console.log(`[FCM] Etkinlik bildirimi: ${r.success} başarı`);
  }
);

// ── 5. Yeni yarış bildirimi
exports.onRaceCreated=onDocumentCreated(
  {document:'races/{raceId}',region:'europe-west1'},
  async(event)=>{
    const data=event.data.data();
    const title='🏆 Yeni Yarış Eklendi!';
    const body=`${data.name||'Yarış'} — ${data.date||''} ${data.location||''}`.trim();
    const url=`${DEFAULT_URL}#races/${event.params.raceId}`;
    const tokens=await getAllFcmTokens();
    if(!tokens.length)return;
    const r=await sendBatch(tokens,title,body,url,DEFAULT_ICON,'');
    console.log(`[FCM] Yarış bildirimi: ${r.success} başarı`);
  }
);

// ── 6. Temizlik
exports.cleanOldNotifications=onSchedule(
  {schedule:'every day 04:00',timeZone:'Europe/Istanbul',region:'europe-west1'},
  async()=>{
    const cutoff=new Date();
    cutoff.setDate(cutoff.getDate()-30);
    const snap=await db.collection('pushNotifications').where('createdAt','<',cutoff).get();
    if(snap.empty){console.log('[Cleanup] Temizlenecek yok.');return;}
    const batch=db.batch();
    snap.forEach(doc=>batch.delete(doc.ref));
    await batch.commit();
    console.log(`[Cleanup] ${snap.size} eski bildirim silindi.`);
  }
);
