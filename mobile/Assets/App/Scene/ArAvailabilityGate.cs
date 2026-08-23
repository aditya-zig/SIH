using System;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace SurakshaAR.Scene
{
    public sealed class ArAvailabilityGate : MonoBehaviour
    {
        public event Action<bool>? AvailabilityResolved;

        private async void Start()
        {
            await CheckAvailability();
        }

        private async Task CheckAvailability()
        {
            if (ARSession.state == ARSessionState.None)
            {
                await ARSession.CheckAvailability();
            }

            var available = ARSession.state == ARSessionState.Ready
                || ARSession.state == ARSessionState.SessionInitializing
                || ARSession.state == ARSessionState.SessionTracking;
            AvailabilityResolved?.Invoke(available);
        }
    }
}
