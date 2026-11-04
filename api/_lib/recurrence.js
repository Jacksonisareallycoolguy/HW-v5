// Returns whether a custom item occurs on the specified local calendar day.
function occursOn(item, target) {
  const rule=item.recurrence;
  if(!rule||!rule.frequency)return item.date===target;
  if(target<item.date||(rule.until&&target>rule.until))return false;
  const start=new Date(item.date+'T12:00:00Z'),day=new Date(target+'T12:00:00Z');
  if(!Number.isFinite(start.getTime())||!Number.isFinite(day.getTime()))return false;
  const elapsed=Math.round((day-start)/864e5),dow=day.getUTCDay();
  const weeks=Math.floor((elapsed+start.getUTCDay())/7);
  switch(rule.frequency){
    case 'daily':return true;
    case 'weekly':return Array.isArray(rule.days)&&rule.days.includes(dow);
    case 'biweekly':return weeks%2===0&&Array.isArray(rule.days)&&rule.days.includes(dow);
    case 'monthly':return day.getUTCDate()===start.getUTCDate();
    default:return false;
  }
}
module.exports={occursOn};
