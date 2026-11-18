// The host first exports to a new local filename. Upload needs its own review.
export async function run(context,input){
 await context.exports.gif(input);
 await context.exports.upload({destinationId:'reviewed-put'});
}
