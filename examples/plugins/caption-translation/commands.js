export async function run(context, input) {
  await context.transcript.read();
  await context.progress(0.1, 'Translating caption cues');
  const translations = await context.ai.translateCaptions({ language: input.language });
  await context.captions.addTranslation({ language: input.language, translations });
  await context.progress(0.9, 'Caption translation ready for review');
  return { message: 'A translated caption track was prepared for host review.' };
}
