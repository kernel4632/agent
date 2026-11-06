package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCompactWaitsForModelHeadersAndHonorsCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(80 * time.Millisecond):
			fmt.Fprint(w, `{"content":"summary"}`)
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	client, _ := New(server.URL)
	transport := client.http.Transport.(*http.Transport)
	transport.ResponseHeaderTimeout = 10 * time.Millisecond
	var result struct {
		Content string `json:"content"`
	}
	if err := client.Compact(context.Background(), "s", &result); err != nil {
		t.Fatal(err)
	}
	if result.Content != "summary" {
		t.Fatal(result)
	}
	if transport.ResponseHeaderTimeout != 10*time.Millisecond {
		t.Fatal("changed normal endpoint timeout")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := client.Compact(ctx, "s", &result); err == nil {
		t.Fatal("ignored cancellation")
	}
}
