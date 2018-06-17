# Dancing Together API

## Player State Change
### Request
```json
{
    "type": "object",
    "properties": {
        "command": "player_state_change",
        "request_id": {"type": "number"},
        "state": {
            "type": "object",
            "properties": {
                "context_uri": {"type": "string"},
                "current_track_uri": {"type": "string"},
                "paused": {"type": "boolean"},
                "raw_position_ms": {"type": "number", "minimum": 0},
                "sample_time": {"type": "string"}
            },
            "required": [
                "context_uri",
                "current_track_uri",
                "paused",
                "raw_position_ms",
                "sample_time"
            ]
        },
        "etag": {"type": "string"}
    },
    "required": ["command", "request_id", "state"]
}
```

### Response
```json
{
    "type": "object",
    "properties": {
        "type": "ensure_playback_state",
        "request_id": {"type": "number"},
        "state": {
            "type": "object",
            "properties": {
                "context_uri": {"type": "string"},
                "current_track_uri": {"type": "string"},
                "paused": {"type": "boolean"},
                "raw_position_ms": {"type": "number", "minimum": 0},
                "sample_time": {"type": "string"},
                "etag": {"type": "string"}
            },
            "required": [
                "context_uri",
                "current_track_uri",
                "paused",
                "raw_position_ms",
                "sample_time",
                "etag"
            ]
        },
    },
    "required": ["command", "request_id", "state"]
}
```


## Ping
### Request
```json
{
    "type": "object",
    "properties": {
        "start_time": {"type": "string"}
    },
    "required": ["start_time"]
}
```

### Response
```json
{
    "type": "object",
    "properties": {
        "start_time": {"type": "string"}
    },
    "required": ["start_time"]
}
```


## Refresh Access Token
### Request
```json
{
    "type": "object",
    "properties": {
        "type": "refresh_access_token",
    },
    "required": ["type"]
}
```

### Response
```json
{
    "type": "object",
    "properties": {
        "type": "access_token_change",
        "access_token": {"type": "string"}
    },
    "required": ["type", "access_token"]
}
```


## Admin: Get Listeners
### Request
TODO

### Response
TODO


## Admin: Send Listener Invite
### Request
TODO

### Response
TODO
