using UnityEngine;

namespace SurakshaAR.Scene
{
    [DisallowMultipleComponent]
    public sealed class TrainingTarget : MonoBehaviour
    {
        [SerializeField]
        private string actionKind = "select";

        [SerializeField]
        private string targetId = string.Empty;

        public string ActionKind => actionKind;

        public string TargetId => targetId;
    }
}
