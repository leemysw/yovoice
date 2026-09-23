package workbench

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractExplicitDirectories(t *testing.T) {
	for _, format := range []string{"zip", "tar.gz"} {
		t.Run(format, func(t *testing.T) {
			root := t.TempDir()
			archive := filepath.Join(root, "runtime."+format)
			file, err := os.Create(archive)
			must(t, err)
			if format == "zip" {
				writer := zip.NewWriter(file)
				for _, name := range []string{"tools/", "tools/nested/"} {
					_, err = writer.Create(name)
					must(t, err)
				}
				entry, err := writer.Create("tools/nested/readme.txt")
				must(t, err)
				_, err = entry.Write([]byte("runtime"))
				must(t, err)
				must(t, writer.Close())
			} else {
				compressed := gzip.NewWriter(file)
				writer := tar.NewWriter(compressed)
				for _, name := range []string{"./tools/", "./tools/nested/"} {
					must(t, writer.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeDir, Mode: 0755}))
				}
				must(t, writer.WriteHeader(&tar.Header{Name: "./tools/nested/readme.txt", Typeflag: tar.TypeReg, Mode: 0644, Size: 7}))
				_, err = writer.Write([]byte("runtime"))
				must(t, err)
				must(t, writer.Close())
				must(t, compressed.Close())
			}
			must(t, file.Close())
			destination := filepath.Join(root, "extracted")
			must(t, Extract(context.Background(), archive, destination))
			content, err := os.ReadFile(filepath.Join(destination, "tools", "nested", "readme.txt"))
			must(t, err)
			if string(content) != "runtime" {
				t.Fatal("解压后的文件内容不一致")
			}
		})
	}
}
