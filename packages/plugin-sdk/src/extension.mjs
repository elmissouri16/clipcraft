// Node extensions receive their public services through activate(context).
export function defineExtension(extension){if(!extension||typeof extension.activate!=='function')throw new TypeError('Extension must provide activate(context)');return extension;}
import contracts from '../../../shared/extensionServices.cjs';
/** Validate a portable service contract while preserving its inferred types. */
export function defineServiceContract(contract){contracts.serviceContract(contract);return contract;}
