type Job={id:string;actor:string;branch_id:string;generation:string;input:string;response:string;status:string;created_at:number};
/** Scope and bound history again even though the database query is scoped. */
export function conversationContext(jobs:Job[],scope:{actor:string;branch:string;generation:string;now:number;currentId:string}){
 return jobs.filter(j=>j.id!==scope.currentId&&j.actor===scope.actor&&j.branch_id===scope.branch&&j.generation===scope.generation&&j.created_at>scope.now-1800000&&j.created_at<=scope.now&&['error','read','ready','done','cancelled'].includes(j.status))
 .sort((a,b)=>b.created_at-a.created_at).slice(0,6).reverse().map(j=>({user:j.input.slice(0,2500),assistant:j.response.slice(0,3500),status:j.status}));
}
