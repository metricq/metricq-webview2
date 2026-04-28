package main

var suggestableFields = []string{
	"site", "room", "rack", "feed", "asset_type", "asset_id",
	"location_code", "metric_type", "circuit", "phase", "source",
	"cluster", "system", "service", "team", "criticality",
	"scope", "position",
}

var suggestableFieldSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(suggestableFields))
	for _, f := range suggestableFields {
		m[f] = struct{}{}
	}
	return m
}()
