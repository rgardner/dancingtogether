import * as React from "react";
import { CircularArray, median } from "../util";

export interface IStationDebugProps {
    roundTripTimes: CircularArray<number>;
    clientServerTimeOffsets: CircularArray<number>;
}

export function StationDebug(props: IStationDebugProps) {
    const medianRoundTripTime = median(props.roundTripTimes.array);
    const joinedRoundTripTimes = props.roundTripTimes.array.map(time => `${time}ms`).join(', ');

    const medianClientServerTimeOffset = median(props.clientServerTimeOffsets.array);
    const joinedClientServerTimeOffsets = props.clientServerTimeOffsets.array.map(time => `${time}ms`).join(', ');

    return (
        <div>
            Round Trip Times: Median: {medianRoundTripTime}ms. All: {joinedRoundTripTimes}.<br />
            Client Server Time Offsets: Median: {medianClientServerTimeOffset}ms. All: {joinedClientServerTimeOffsets}.<br />
        </div>
    );
}
