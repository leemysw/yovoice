package workbench

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

type Server struct {
	Workbench      *Workbench
	Assets, Secret string
	Shutdown       func()
	calls          sync.Mutex
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cookie, e := r.Cookie("vw-" + s.Secret[:12])
	if !strings.HasPrefix(r.Host, "127.0.0.1:") || e != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(s.Secret)) != 1 || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host) {
		http.Error(w, "Forbidden", 403)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
	r.Body = http.MaxBytesReader(w, r.Body, 28<<20)
	switch {
	case r.URL.Path == "/api/call" && r.Method == "POST":
		var message struct {
			ID     string          `json:"id"`
			Method string          `json:"method"`
			Data   json.RawMessage `json:"data"`
		}
		if e = json.NewDecoder(r.Body).Decode(&message); e != nil {
			http.Error(w, "请求无效。", 400)
			return
		}
		s.calls.Lock()
		result, err := s.Workbench.Call(message.Method, message.Data)
		s.calls.Unlock()
		reply := map[string]any{"id": message.ID, "result": result}
		if err != nil {
			reply = map[string]any{"id": message.ID, "error": err.Error()}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(reply)
	case r.URL.Path == "/api/state-events" && r.Method == "GET":
		ch, unsubscribe := s.Workbench.Store.Subscribe()
		defer unsubscribe()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		flusher, ok := w.(http.Flusher)
		if !ok {
			return
		}
		for {
			select {
			case <-r.Context().Done():
				return
			case <-ch:
				b, e := json.Marshal(map[string]any{"event": "state", "state": s.Workbench.Store.Read()})
				if e != nil {
					return
				}
				if _, e = fmt.Fprintf(w, "data: %s\n\n", b); e != nil {
					return
				}
				flusher.Flush()
			}
		}
	case strings.HasPrefix(r.URL.Path, "/media/") && (r.Method == "GET" || r.Method == "HEAD"):
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/media/"), "/")
		if len(parts) != 2 {
			http.NotFound(w, r)
			return
		}
		path, e := s.Workbench.Store.MediaPath(parts[0], parts[1])
		if e != nil {
			http.Error(w, "无效路径", 400)
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		http.ServeFile(w, r, path)
	case r.URL.Path == "/shutdown" && r.Method == "POST":
		s.calls.Lock()
		s.Workbench.Close()
		s.calls.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
		if s.Shutdown != nil {
			go s.Shutdown()
		}
	default:
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		http.FileServer(http.Dir(s.Assets)).ServeHTTP(w, r)
	}
}
