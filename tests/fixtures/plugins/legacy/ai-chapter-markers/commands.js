export async function run(context, input) {
  await context.transcript.read();
  await context.progress(0.1, 'Requesting chapter suggestions');
  const chapters = await context.ai.chapters({ count: input.count });
  await context.markers.add(chapters);
  await context.progress(0.9, 'Chapter suggestions ready for review');
  return { message: 'Chapter suggestions prepared for host review.' };
}
