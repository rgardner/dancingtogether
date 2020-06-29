import * as React from "react";

import { IListener } from "../station";

export interface IStationAdminProps {
  isReady: boolean;
  listeners: IListener[];
  responseStatus?: string;
  onListenerInviteSubmit(username: string): void;
  onListenerDeleteSubmit(listenerId: number): void;
}

export function StationAdmin(props: IStationAdminProps): JSX.Element {
  return (
    <div>
      <StationListeners
        listeners={props.listeners}
        onListenerDeleteSubmit={props.onListenerDeleteSubmit}
      />

      <h3>Invite listeners</h3>
      <InviteListenerForm
        isReady={props.isReady}
        onSubmit={props.onListenerInviteSubmit}
      />

      {props.responseStatus && <p>{props.responseStatus}</p>}
    </div>
  );
}

interface IStationListenersProps {
  listeners: IListener[];
  onListenerDeleteSubmit(listenerId: number): void;
}

function StationListeners(props: IStationListenersProps) {
  return (
    <div>
      <h2>Listeners</h2>
      <table className="table table-striped">
        <tbody>
          {props.listeners.map((listener) => {
            return (
              <tr key={listener.id}>
                <td>{listener.username}</td>
                <td>
                  <button
                    className="btn btn-warning btn-sm"
                    onClick={props.onListenerDeleteSubmit.bind(
                      null,
                      listener.id
                    )}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface IInviteListenerFormProps {
  isReady: boolean;
  onSubmit(username: string): void;
}

interface IInviteListenerFormState {
  username: string;
}

class InviteListenerForm extends React.Component<
  IInviteListenerFormProps,
  IInviteListenerFormState
> {
  constructor(props: IInviteListenerFormProps) {
    super(props);
    this.state = {
      username: "",
    };

    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  public render() {
    return (
      <form className="form-inline" onSubmit={this.handleSubmit}>
        <input
          type="text"
          className="form-control form-control-sm"
          placeholder="username"
          disabled={!this.props.isReady}
          onChange={this.handleChange}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!this.props.isReady || this.state.username === ""}
        >
          Send invite
        </button>
      </form>
    );
  }

  private handleChange(event: any) {
    this.setState({ username: event.target.value });
  }

  private handleSubmit(event: any) {
    event.preventDefault();
    this.props.onSubmit(this.state.username);
  }
}
