package command

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInvalidInputDoesNotCreateSession(t *testing.T) {
	for _, args := range [][]string{
		{"ask", " "}, {"ask", "x", "--reasoning", "invalid"},
		{"ask", "x", "--permission", "always"}, {"ask", "--resume"},
		{"sessions", "decide", "s", "c", "yes"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Error("unexpected mutation", r.URL)
				w.WriteHeader(500)
			}))
			defer server.Close()
			cmd := New()
			cmd.SetArgs(append([]string{"--server", server.URL}, args...))
			if err := cmd.Execute(); err == nil {
				t.Fatal("expected failure")
			}
		})
	}
}

func TestModelListingDoesNotExposeProviderCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"providers":[{"name":"test","apiKey":"SECRET","headers":{"Authorization":"SECRET"},"models":[{"id":"model","name":"模型"}]}]}`)
	}))
	defer server.Close()
	cmd := New()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetArgs([]string{"--server", server.URL, "models", "--json"})
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "SECRET") || !strings.Contains(out.String(), "模型") {
		t.Fatal(out.String())
	}
}
