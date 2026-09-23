package workbench

import (
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func parseProxyURL(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, Err(MsgErrProxyURL, nil)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || u.Hostname() == "" ||
		(u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5") ||
		u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, Err(MsgErrProxyURL, nil)
	}
	return u, nil
}

func downloadProxy(req *http.Request, address string) (*url.URL, error) {
	// 本机请求始终直连，代理配置只影响远程下载。
	host := req.URL.Hostname()
	if strings.EqualFold(host, "localhost") || net.ParseIP(host).IsLoopback() {
		return nil, nil
	}
	if address == "" {
		return http.ProxyFromEnvironment(req)
	}
	return parseProxyURL(address)
}
