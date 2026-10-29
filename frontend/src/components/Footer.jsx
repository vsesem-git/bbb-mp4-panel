import { BUILD_VERSION } from '../version';

export default function Footer() {
  return (
    <footer
      style={{
        marginTop: 40,
        padding: 14,
        borderTop: '1px solid #e5e7eb',
        textAlign: 'center',
        color: '#6b7280',
        fontSize: 12,
        background: '#fff',
      }}
    >
      Сборка <strong>{BUILD_VERSION}</strong> &bull; bbb-mp4-panel
    </footer>
  );
}
