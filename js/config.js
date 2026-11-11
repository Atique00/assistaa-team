/* Assistaa Team app settings. Safe to be public: no passwords or secrets here. */
self.ASSISTAA = {
  owner: 'Atiq',
  // Owner-only Map tab feed (needs the owner PIN)
  // Backend: Supabase (since 10 Nov 2026). Old Google Sheets backend, kept for rollback and the issue portal:
  //   store   https://script.google.com/macros/s/AKfycbwMJQ65AJDtd5Mcm2o0tDrHQrrORhJ8Or2JZbgGp3YPE8-ulGO1udym8wdyft61ulI8/exec
  //   support https://script.google.com/macros/s/AKfycbw6sdvJeWbKmsVCFoCV6RrIRiRdJkG-k2eN4C-_fdIOeP2Nok1zk8ecHoPZjEJcesdT/exec
  issuesUrl: 'https://script.google.com/macros/s/AKfycbwMJQ65AJDtd5Mcm2o0tDrHQrrORhJ8Or2JZbgGp3YPE8-ulGO1udym8wdyft61ulI8/exec?view=issues',
  backends: {
    store: {
      label: 'Store team',
      sub: "Glenn & Dion's stores",
      icon: 'store',
      url: 'https://zciuchdximmzwiisdkqu.supabase.co/functions/v1/team-api?team=store&forceFunctionRegion=ap-southeast-1'
    },
    support: {
      label: 'Support team',
      sub: 'Peptonix customer care',
      icon: 'headset',
      url: 'https://zciuchdximmzwiisdkqu.supabase.co/functions/v1/team-api?team=support&forceFunctionRegion=ap-southeast-1'
    }
  },
  firebase: {
    apiKey: 'AIzaSyCEenwybbueU54aMOYdN3Tuv-9TanOlWVU',
    authDomain: 'assistaa-ce837.firebaseapp.com',
    projectId: 'assistaa-ce837',
    storageBucket: 'assistaa-ce837.firebasestorage.app',
    messagingSenderId: '285837452867',
    appId: '1:285837452867:web:fba267f88909ae7ce6d6f6'
  },
  vapidKey: 'BH0yKADRK9ELZpyBWnbF1_IUw2tPfaUyohp5rafUDnMskZrPeDfPbRRXGqqbnP89U8fZz1SYswkzZlqGTR73hnw'
};
