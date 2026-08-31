import { redactText, WebAccessError } from "../core/errors.ts";
import type {
	ProviderAdapter,
	ProviderExecution,
	SearchAdapterRequest,
	SearchData,
} from "../core/types.ts";
import { buildEndpoint, type HttpResponse } from "../transport/http.ts";
import {
	normalizeHits,
	parseJsonResponse,
	ref,
	requireBaseUrl,
	requireCredential,
	searchQueryWithDomains,
} from "./common.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeRaw(value: unknown, secret: string): unknown {
	if (!secret) return value;
	if (typeof value === "string") return redactText(value, [secret]);
	if (Array.isArray(value))
		return value.map((item) => sanitizeRaw(item, secret));
	if (isRecord(value))
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				sanitizeRaw(item, secret),
			]),
		);
	return value;
}

function errorMessage(parsed: Record<string, unknown>, secret: string): string {
	const message =
		typeof parsed.msg === "string"
			? parsed.msg
			: typeof parsed.message === "string"
				? parsed.message
				: "上游返回错误";
	return redactText(message.trim().slice(0, 500), [secret]);
}

function businessFailure(
	parsed: Record<string, unknown>,
	request: SearchAdapterRequest,
): never {
	const code = parsed.code as number;
	let errorCode:
		| "auth_error"
		| "quota_exceeded"
		| "rate_limited"
		| "provider_error" = "provider_error";
	let retryable = true;
	if (code === 401) {
		errorCode = "auth_error";
		retryable = false;
	} else if (code === 403) {
		errorCode = "quota_exceeded";
		retryable = false;
	} else if (code === 429) {
		errorCode = "rate_limited";
	} else if (code >= 400 && code < 500) {
		retryable = false;
	}
	const raw = sanitizeRaw(parsed, request.instance.apiKey ?? "");
	const logId =
		typeof parsed.log_id === "string"
			? ` (log_id: ${redactText(parsed.log_id, [request.instance.apiKey])})`
			: "";
	throw new WebAccessError(
		errorCode,
		`${request.instance.id} 返回业务错误 ${code}: ${errorMessage(parsed, request.instance.apiKey ?? "")}${logId}`,
		{ provider: ref(request.instance), retryable, raw },
	);
}

function assertHttp(
	response: { status: number; body: string },
	request: SearchAdapterRequest,
): void {
	if (response.status >= 200 && response.status < 300) return;
	const parsed = (() => {
		try {
			const value: unknown = JSON.parse(response.body);
			return isRecord(value) ? value : undefined;
		} catch {
			return undefined;
		}
	})();
	const code =
		response.status === 403
			? "quota_exceeded"
			: response.status === 401
				? "auth_error"
				: response.status === 429
					? "rate_limited"
					: "provider_error";
	const retryable = response.status === 429 || response.status >= 500;
	const raw = sanitizeRaw(
		parsed ?? response.body,
		request.instance.apiKey ?? "",
	);
	const msg = parsed ? errorMessage(parsed, request.instance.apiKey ?? "") : "";
	throw new WebAccessError(
		code,
		`${request.instance.id} 返回 HTTP ${response.status}${msg ? `: ${msg}` : ""}`,
		{
			provider: ref(request.instance),
			httpStatus: response.status,
			retryable,
			raw,
		},
	);
}

function invalidResponse(
	request: SearchAdapterRequest,
	parsed: Record<string, unknown>,
	message: string,
): never {
	throw new WebAccessError("invalid_response", message, {
		provider: ref(request.instance),
		retryable: true,
		raw: sanitizeRaw(parsed, request.instance.apiKey ?? ""),
	});
}

function responseData(
	parsed: Record<string, unknown>,
	request: SearchAdapterRequest,
): SearchData {
	if (parsed.data === undefined || !isRecord(parsed.data))
		invalidResponse(request, parsed, `${request.instance.id} 返回缺少 data`);
	const webPages = parsed.data.webPages;
	if (webPages === undefined) return { results: [] };
	if (!isRecord(webPages))
		invalidResponse(
			request,
			parsed,
			`${request.instance.id} 返回无效 webPages`,
		);
	const values = webPages.value;
	if (values === undefined) return { results: [] };
	if (!Array.isArray(values))
		invalidResponse(
			request,
			parsed,
			`${request.instance.id} 返回无效 webPages.value`,
		);
	const items = values.map((item) => {
		if (!isRecord(item)) return item;
		const summary =
			typeof item.summary === "string" && item.summary.trim()
				? item.summary
				: item.snippet;
		return {
			title: item.name,
			url: item.url,
			snippet: typeof summary === "string" ? summary : "",
		};
	});
	return {
		results: normalizeHits(
			items,
			request.limit,
			request.includeDomains,
			request.excludeDomains,
		),
	};
}

function parseResponse(
	response: HttpResponse,
	request: SearchAdapterRequest,
): Record<string, unknown> {
	try {
		return parseJsonResponse(response, request.instance);
	} catch (error) {
		if (!(error instanceof WebAccessError)) throw error;
		throw new WebAccessError(
			error.code,
			redactText(error.message, [request.instance.apiKey]),
			{
				provider: ref(request.instance),
				httpStatus: error.httpStatus ?? response.status,
				retryable: error.retryable,
				raw: sanitizeRaw(error.raw, request.instance.apiKey ?? ""),
			},
		);
	}
}

function requestHeaders(
	request: SearchAdapterRequest,
	key: string,
): Record<string, string> {
	const protectedNames = new Set(["authorization", "content-type", "accept"]);
	const headers = Object.fromEntries(
		Object.entries(request.instance.headers).filter(
			([name]) => !protectedNames.has(name.toLowerCase()),
		),
	);
	return {
		...headers,
		Authorization: `Bearer ${key}`,
		"Content-Type": "application/json",
		Accept: "application/json",
	};
}

const bocha: ProviderAdapter = {
	type: "bocha",
	capabilities: ["search"],
	isConfigured: (instance) => !!instance.apiKey && !!instance.baseUrl,
	async search(request): Promise<ProviderExecution<SearchData>> {
		const key = requireCredential(request.instance);
		const freshness = request.freshness
			? { day: "oneDay", month: "oneMonth", year: "oneYear" }[request.freshness]
			: "noLimit";
		const response = await request.transport.request(
			buildEndpoint(requireBaseUrl(request.instance), "v1/web-search"),
			{
				method: "POST",
				headers: requestHeaders(request, key),
				body: JSON.stringify({
					query: searchQueryWithDomains(
						request.query,
						request.includeDomains,
						request.excludeDomains,
					),
					count: request.limit,
					summary: true,
					freshness,
				}),
				signal: request.signal,
				maxResponseBytes: request.maxResponseBytes,
			},
		);
		assertHttp(response, request);
		const parsed = parseResponse(response, request);
		if (parsed.code !== undefined && typeof parsed.code !== "number")
			invalidResponse(request, parsed, `${request.instance.id} 返回无效 code`);
		if (typeof parsed.code === "number" && parsed.code !== 200)
			businessFailure(parsed, request);
		return {
			data: responseData(parsed, request),
			raw: sanitizeRaw(parsed, key),
		};
	},
};

export const BOCHA_ADAPTER = bocha;
