import { APIGatewayProxyResult } from 'aws-lambda';

export function handle(): APIGatewayProxyResult {
	return {
		statusCode: 200,
		body: JSON.stringify({
			message: 'pong'
		})
	};
}
