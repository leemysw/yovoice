package workbench

func ptr(s string) *string { return &s }

func value(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
