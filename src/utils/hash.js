import sha256 from 'js-sha256';

export default (key, value, enabled) => {
	let v = value;
	if (typeof value !== 'string') {
		v = JSON.stringify(v);
	}
	const e = enabled ? '1' : '0';
	const tok = `${key}:${v}:${e}`;
	return sha256(tok);
};
