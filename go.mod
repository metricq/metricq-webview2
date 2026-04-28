module github.com/metricq/metricq-codex

go 1.24

toolchain go1.24.4

require github.com/metricq/metricq-go v0.0.0

require (
	github.com/google/uuid v1.3.1 // indirect
	github.com/rabbitmq/amqp091-go v1.8.1 // indirect
	google.golang.org/protobuf v1.27.1 // indirect
)

replace github.com/metricq/metricq-go => ../metricq-go
