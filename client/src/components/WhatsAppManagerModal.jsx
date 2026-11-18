import InstanceManager from './InstanceManager.jsx';
import Modal from './Modal.jsx';

export default function WhatsAppManagerModal({ onClose }) {
  return (
    <Modal title="Conexões do WhatsApp" onClose={onClose} wide>
      <div className="whatsapp-manager-modal">
        <InstanceManager purpose="envio" />
      </div>
    </Modal>
  );
}
