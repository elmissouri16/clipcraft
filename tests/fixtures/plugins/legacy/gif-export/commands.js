export async function run(context,input){
 await context.exports.gif(input);
 return {message:'GIF settings staged for the host exporter.'};
}
