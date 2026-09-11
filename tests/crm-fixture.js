/* Chargé uniquement par preview-server.cjs. Toutes les requêtes restent sur localhost. */
(function () {
  var session = { user_id:'00000000-0000-0000-0000-000000000001', email:'equipe@example.test', jeton:'fixture-only' };
  window.AV_SERVICE_URL = '/__crm/service';
  window.AVNuage = {
    configure:function(){return true;},
    retrouverEmail:async function(){return session;},
    sessionValide:async function(){return session;},
    requeteAuth:function(path,options){return fetch('/__crm'+path,options);},
    connexion:async function(){session={user_id:'00000000-0000-0000-0000-000000000001',email:'equipe@example.test',jeton:'fixture-only'};return {};},
    deconnexion:function(){session=null;}
  };
  document.addEventListener('DOMContentLoaded',function(){
    var badge=document.createElement('div');badge.className='crm-demo-badge';
    badge.textContent='Démonstration locale · données fictives';
    badge.style.cssText='position:fixed;z-index:100;bottom:0;left:0;right:0;text-align:center;background:#30272b;color:#fff;font:11px sans-serif;padding:5px;pointer-events:none';
    var style=document.createElement('style');
    style.textContent='@media(max-width:680px){.crm-demo-badge{bottom:64px!important}}';
    document.head.appendChild(style);
    document.body.appendChild(badge);
  });
}());
