import * as React from 'react';
import * as ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';
import './Station.css';

import { StationManager, StationMusicPlayer, StationServer } from './station';
import { ListenerRole } from './util';
import { ChannelWebSocketBridge } from './websocket_bridge';

interface IAppData {
  userId: number;
  stationId: number;
  stationTitle: string;
  userIsDJ: boolean;
  userIsAdmin: boolean;
  spotifyConnectPlayerName: string;
  accessToken: string;
  accessTokenExpirationTime: Date;
  debug: boolean;
}

declare const APP_DATA: IAppData;

window.onSpotifyWebPlaybackSDKReady = () => {
  let listenerRole = ListenerRole.None;
  if (APP_DATA.userIsDJ) {
    // tslint:disable-next-line:no-bitwise
    listenerRole |= ListenerRole.DJ;
  }
  if (APP_DATA.userIsAdmin) {
    // tslint:disable-next-line:no-bitwise
    listenerRole |= ListenerRole.Admin;
  }
  const webSocketBridge = new ChannelWebSocketBridge();

  ReactDOM.render(
    <StationManager
      userId={APP_DATA.userId}
      listenerRole={listenerRole}
      stationTitle={APP_DATA.stationTitle}
      server={new StationServer(APP_DATA.stationId, getCrossSiteRequestForgeryToken(), webSocketBridge)}
      clientName={APP_DATA.spotifyConnectPlayerName}
      accessToken={APP_DATA.accessToken}
      accessTokenExpirationTime={APP_DATA.accessTokenExpirationTime}
      debug={APP_DATA.debug}
      initialVolume={StationMusicPlayer.getCachedVolume()}
    />,
    document.getElementById('station')
  );
};

registerServiceWorker();

function getCrossSiteRequestForgeryToken(): string {
  const csrftoken = getCookie('csrftoken');
  if (!csrftoken) {
    console.assert(false, 'Cannot obtain csrftoken');
    throw new Error('Cannot obtain csrftoken');
  }

  return csrftoken;
}

function getCookie(name: string) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      cookie = $.trim(cookie);
      // Does this cookie string begin with the name we want?
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }

  return cookieValue;
}
