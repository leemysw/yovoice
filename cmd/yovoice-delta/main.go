// 发布时基于两个已打包的目录生成补丁，并保留完整安装包供回退。
package main

import (
	"fmt"
	"os"
	"yovoice/internal/appdelta"
)

func main() {
	if len(os.Args) != 6 {
		fmt.Fprintln(os.Stderr, "用法：yovoice-delta 旧版本 新版本 旧目录 新目录 补丁路径")
		os.Exit(2)
	}
	args := os.Args[1:]
	f, err := os.Create(args[4])
	if err == nil {
		err = appdelta.WriteDelta(f, args[0], args[1], args[2], args[3], nil)
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			os.Remove(args[4])
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
