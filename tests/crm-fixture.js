/* Chargé uniquement par preview-server.cjs. Toutes les requêtes restent sur localhost. */
(function () {
  var session = { user_id:'00000000-0000-0000-0000-000000000001', email:'equipe@example.test', jeton:'fixture-only' };
  window.AV_SERVICE_URL = '/__crm/service';
  // ?stripe=off permet aussi de vérifier le verrou livré en production.
  window.AV_CRM_STRIPE_ACTIF = new URLSearchParams(location.search).get('stripe') !== 'off';
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
    badge.style.cssText='margin-top:24px;text-align:center;color:#6b6064;font:11px sans-serif;padding:8px;pointer-events:none';
    document.getElementById('p-tableau').appendChild(badge);
    document.querySelector('.marque small').textContent='Démonstration · données fictives';
  });
}());
