using System.Threading.Tasks;
using UnityEngine;

namespace SurakshaAR.Application
{
    public sealed class BackendService : MonoBehaviour
    {
        private static BackendService? instance;

        [SerializeField]
        private string supabaseUrl = string.Empty;

        [SerializeField]
        private string supabaseKey = string.Empty;

        private void Awake()
        {
            if (instance == null)
            {
                instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
            }
        }

        public async Task<bool> LoginTrainer(string email, string password)
        {
            Debug.Log("Login requested for " + email);
            await Task.Yield();
            return !string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(password);
        }

        public async Task SyncProgress(string workerId, string courseId, int chapter)
        {
            Debug.Log($"SyncProgress worker:{workerId} course:{courseId} chapter:{chapter}");
            await Task.Yield();
        }

        public static BackendService Instance => instance ?? throw new System.InvalidOperationException("BackendService not initialized.");
    }
}
