import defu from "defu";
import {
  type H3Event,
  appendResponseHeader,
  eventHandler,
  getHeader,
  proxyRequest,
  sendRedirect,
  setHeaders,
} from "h3";
import type { NitroRouteRules } from "nitro/types";
import { createRouter as createRadixRouter, toRouteMatcher } from "radix3";
import { getQuery, joinURL, withQuery, withoutBase } from "ufo";
import { useRuntimeConfig } from "./config";

const config = useRuntimeConfig();
const _routeRulesMatcher = toRouteMatcher(
  createRadixRouter({ routes: config.nitro.routeRules })
);

const redirectedHeader = "x-nitro-redirect"
const proxiedHeader = "x-nitro-proxy"
export function createRouteRulesHandler(ctx: {
  localFetch: typeof globalThis.fetch;
}) {
  return eventHandler((event) => {
    // Match route options against path
    const routeRules = getRouteRules(event);
    // Apply headers options
    if (routeRules.headers) {
      setHeaders(event, routeRules.headers);
    }
    const isRedirected = !!getHeader(event, redirectedHeader)
    const isProxied = !!getHeader(event, proxiedHeader)
    // Apply redirect options
    if (!isRedirected && routeRules.redirect) {
      let target = routeRules.redirect.to;
      if (target.endsWith("/**")) {
        let targetPath = event.path;
        const strpBase = (routeRules.redirect as any)._redirectStripBase;
        if (strpBase) {
          targetPath = withoutBase(targetPath, strpBase);
        }
        target = joinURL(target.slice(0, -3), targetPath);
      } else if (event.path.includes("?")) {
        const query = getQuery(event.path);
        target = withQuery(target, query);
      }
      appendResponseHeader(event, redirectedHeader, "true");
      return sendRedirect(event, target, routeRules.redirect.statusCode);
    }
    // Apply proxy options
    if (!isProxied && routeRules.proxy) {
      let target = routeRules.proxy.to;
      if (target.endsWith("/**")) {
        let targetPath = event.path;
        const strpBase = (routeRules.proxy as any)._proxyStripBase;
        if (strpBase) {
          targetPath = withoutBase(targetPath, strpBase);
        }
        target = joinURL(target.slice(0, -3), targetPath);
      } else if (event.path.includes("?")) {
        const query = getQuery(event.path);
        target = withQuery(target, query);
      }
      return proxyRequest(event, target, {
        fetch: ctx.localFetch,
        headers: {
          [proxiedHeader]: "true",
        },
        ...routeRules.proxy,
      });
    }
  });
}

export function getRouteRules(event: H3Event): NitroRouteRules {
  event.context._nitro = event.context._nitro || {};
  if (!event.context._nitro.routeRules) {
    event.context._nitro.routeRules = getRouteRulesForPath(
      withoutBase(event.path.split("?")[0], useRuntimeConfig().app.baseURL)
    );
  }
  return event.context._nitro.routeRules;
}

// prettier-ignore
type DeepReadonly<T> = T extends Record<string, any>
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends Array<infer U>
  ? ReadonlyArray<DeepReadonly<U>>
  : T;

/**
 * @param path - The path to match against route rules. This should not contain a query string.
 */
export function getRouteRulesForPath(
  path: string
): DeepReadonly<NitroRouteRules> {
  return defu({}, ..._routeRulesMatcher.matchAll(path).reverse());
}
