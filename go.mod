module github.com/metricq/metricq-webview2

go 1.26

require github.com/metricq/metricq-go v0.0.0

require (
	github.com/google/uuid v1.6.0 // indirect
	github.com/rabbitmq/amqp091-go v1.13.0 // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)

replace github.com/metricq/metricq-go => ../metricq-go
