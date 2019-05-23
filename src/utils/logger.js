export const ServiceName = {
	Payments: 'PaymentsService',
	CPMS: 'CPMSOrchestrationService',
	Documents: 'DocumentsService',
};

export function logInfo(logName, message) {
	console.log(JSON.stringify({
		logLevel: 'INFO',
		message,
		logName,
	}, null, 2));
}

export function logError(logName, message) {
	console.error(JSON.stringify({
		logLevel: 'ERROR',
		message,
		logName: `${logName}Error`,
	}, null, 2));
}
