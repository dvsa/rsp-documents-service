import auth from './functions/auth';
import list from './functions/list';
import get from './functions/get';
import create from './functions/create';
import remove from './functions/delete';
import update from './functions/update';
import updateMulti from './functions/updateMulti';
import sites from './functions/sites';
import stream from './functions/stream';
import getDocumentByToken from './functions/getDocumentByToken';

const handler = {
	auth,
	list,
	get,
	getDocumentByToken,
	create,
	remove,
	update,
	updateMulti,
	sites,
	stream,
};

export default handler;
