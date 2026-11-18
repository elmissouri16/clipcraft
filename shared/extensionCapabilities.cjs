// Feature revisions are additive contracts, independent of app/SDK versions.
const features=Object.freeze(Object.fromEntries(['commands','events','services','services.contracts','hooks','workspace.inspection','editor.transactions','editor.tools','markers','captions','media','exports','files.publish','processes','jobs','configuration','configuration.project','secrets','ui.settings','ui.actions','ui.shortcuts','ui.messages','ui.dialogs','ui.views'].map(name=>[name,1])));
module.exports={capabilities:()=>({apiVersion:1,features:{...features}})};
