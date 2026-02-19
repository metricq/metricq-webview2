package main

import "time"

func parseISOToUnixMS(v string) (int64, error) {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return 0, err
	}
	return t.UnixMilli(), nil
}

func containsFn(list []string, fn string) bool {
	for _, item := range list {
		if item == fn {
			return true
		}
	}
	return false
}
