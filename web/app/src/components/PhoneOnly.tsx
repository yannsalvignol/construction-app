import { useAuth } from '../lib/auth';

export function PhoneOnly() {
  const { signOut } = useAuth();
  return (
    <div className="notice">
      <img src="/logo.png" alt="" />
      <h1>L’application employé est sur votre téléphone</h1>
      <p className="fg2">Journées, vérifications de présence et position en direct ont besoin de la caméra, du GPS et des notifications d’un téléphone. Installez CASPROD sur iPhone ou Android et connectez-vous là-bas. Cet espace web est réservé aux chefs de chantier.</p>
      <button className="btn" onClick={signOut}>Se déconnecter</button>
    </div>
  );
}
