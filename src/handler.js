import auth from './functions/auth';
import list from './functions/list';
import get from './functions/get';
import create from './functions/create';
import remove from './functions/delete';
import updateMulti from './functions/updateMulti';
import sites from './functions/sites';
import stream from './functions/stream';
import updateWithPayment from './functions/updateWithPayment';

const handler = {
	auth,
	list,
	get,
	create,
	remove,
	updateMulti,
	sites,
	stream,
	updateWithPayment,
};

export default handler;
