// The same pinned catalog as ClipCraft's existing local transcription feature.
// Model bytes are downloaded or explicitly imported, never bundled in the extension.
export const models={
 base:{file:'ggml-base.bin',size:147951465,sha256:'60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'},
 turbo:{file:'ggml-large-v3-turbo-q5_0.bin',size:574041195,sha256:'394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'},
 darija:{file:'ggml-medium-darija-q5_0.bin',size:539212484,sha256:'1271472614bae20fdf0d7f99be18ce2b881036f6a26df501fbfc3bdde48888ce',url:'https://huggingface.co/MedHachim/whisper-medium-darija-ggml/resolve/main/ggml-medium-darija-q5_0.bin'}
};
export type ModelId=keyof typeof models;
