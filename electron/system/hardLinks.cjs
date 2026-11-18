// Publishing a finished file with a hard link is atomic and never overwrites. Volumes without hard links refuse it
// with one of these codes: ENOTSUP / EOPNOTSUPP / EPERM on most systems, EXDEV across volumes, EMLINK when a file
// has too many links, and on Windows EISDIR or EINVAL for FAT and exFAT drives. Callers then fall back to a copy
// (exclusive where it publishes, so a real conflict such as an existing file or directory fails on the copy).
const NO_HARD_LINK = new Set(['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'EMLINK', 'EISDIR', 'EINVAL']);
const hardLinkUnsupported = (error) => NO_HARD_LINK.has(error?.code);
module.exports = { hardLinkUnsupported, NO_HARD_LINK };
