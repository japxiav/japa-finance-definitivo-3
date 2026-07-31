import React from 'react';

type Props = { children: React.ReactNode };
type State = { error?: Error };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Japa Finance render failure', error, info);
  }

  private recover = () => {
    this.setState({ error: undefined });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error-screen" role="alert">
        <section>
          <span>JF</span>
          <small>RECUPERAÇÃO SEGURA</small>
          <h1>O aplicativo encontrou um erro de tela.</h1>
          <p>Seus dados locais não foram apagados. Recarregue para restaurar a interface.</p>
          <details>
            <summary>Detalhes técnicos</summary>
            <code>{this.state.error.message}</code>
          </details>
          <button type="button" onClick={this.recover}>Recarregar aplicativo</button>
        </section>
      </main>
    );
  }
}
