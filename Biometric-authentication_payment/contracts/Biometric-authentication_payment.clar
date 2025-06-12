;; Biometric Authentication Payment System Smart Contract
;; Built with Clarinet for Stacks blockchain

;; Constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-insufficient-balance (err u101))
(define-constant err-payment-not-found (err u102))
(define-constant err-invalid-amount (err u103))
(define-constant err-biometric-not-registered (err u104))
(define-constant err-biometric-verification-failed (err u105))
(define-constant err-user-not-found (err u106))
(define-constant err-payment-expired (err u107))
(define-constant err-unauthorized (err u108))
(define-constant err-biometric-already-registered (err u109))
(define-constant err-invalid-biometric-data (err u110))
(define-constant err-payment-already-processed (err u111))

;; Data Variables
(define-data-var payment-counter uint u0)
(define-data-var biometric-counter uint u0)
(define-data-var authentication-timeout uint u300) ;; 5 minutes in seconds
(define-data-var max-retry-attempts uint u3)

;; Data Maps

;; Biometric data storage (hashed for privacy)
(define-map biometric-profiles principal 
  {
    biometric-hash: (buff 32),
    backup-hash: (buff 32),
    is-active: bool,
    registration-id: uint,
    last-updated: uint,
    failed-attempts: uint,
    is-locked: bool
  })

;; User payment profiles
(define-map user-profiles principal 
  {
    display-name: (string-ascii 64),
    default-payment-limit: uint,
    daily-spent: uint,
    last-reset-day: uint,
    is-verified: bool,
    registration-date: uint
  })

;; Payment requests requiring biometric authentication
(define-map payment-requests uint 
  {
    payer: principal,
    payee: principal,
    amount: uint,
    description: (string-ascii 128),
    status: (string-ascii 20),
    created-at: uint,
    expires-at: uint,
    requires-biometric: bool,
    biometric-verified: bool
  })

;; Authentication sessions
(define-map auth-sessions (buff 32) 
  {
    user: principal,
    payment-id: uint,
    created-at: uint,
    expires-at: uint,
    is-used: bool
  })

;; Merchant accounts for receiving payments
(define-map merchants principal 
  {
    business-name: (string-ascii 64),
    is-verified: bool,
    total-received: uint,
    transaction-count: uint
  })

;; Read-only functions

(define-read-only (get-biometric-profile (user principal))
  (map-get? biometric-profiles user))

(define-read-only (get-user-profile (user principal))
  (map-get? user-profiles user))

(define-read-only (get-payment-request (payment-id uint))
  (map-get? payment-requests payment-id))

(define-read-only (get-merchant-info (merchant principal))
  (map-get? merchants merchant))

(define-read-only (get-payment-counter)
  (var-get payment-counter))

(define-read-only (get-authentication-timeout)
  (var-get authentication-timeout))

(define-read-only (is-biometric-registered (user principal))
  (match (map-get? biometric-profiles user)
    profile (get is-active profile)
    false))

(define-read-only (is-user-verified (user principal))
  (match (map-get? user-profiles user)
    profile (get is-verified profile)
    false))

(define-read-only (get-daily-spending-limit (user principal))
  (match (map-get? user-profiles user)
    profile (get default-payment-limit profile)
    u0))

;; Private functions

(define-private (is-payment-expired (payment-id uint))
  (match (map-get? payment-requests payment-id)
    payment-data 
      (let ((current-time u0)) ;; Simplified for older Clarinet
        (> current-time (get expires-at payment-data)))
    true))

(define-private (hash-biometric-data (biometric-data (buff 64)))
  (sha256 biometric-data))

(define-private (verify-biometric-hash (stored-hash (buff 32)) (provided-hash (buff 32)))
  (is-eq stored-hash provided-hash))

(define-private (reset-daily-spending (user principal))
  (match (map-get? user-profiles user)
    profile
      (map-set user-profiles user (merge profile { 
        daily-spent: u0,
        last-reset-day: u0 ;; Simplified timestamp
      }))
    false))

(define-private (increment-failed-attempts (user principal))
  (match (map-get? biometric-profiles user)
    profile
      (let ((new-attempts (+ (get failed-attempts profile) u1)))
        (map-set biometric-profiles user (merge profile { 
          failed-attempts: new-attempts,
          is-locked: (>= new-attempts (var-get max-retry-attempts))
        })))
    false))

(define-private (reset-failed-attempts (user principal))
  (match (map-get? biometric-profiles user)
    profile
      (map-set biometric-profiles user (merge profile { 
        failed-attempts: u0,
        is-locked: false
      }))
    false))

;; Public functions

;; Register biometric profile
(define-public (register-biometric (biometric-hash (buff 32)) (backup-hash (buff 32)) (display-name (string-ascii 64)))
  (let ((registration-id (+ (var-get biometric-counter) u1)))
    (begin
      ;; Check if biometric already registered
      (asserts! (is-none (map-get? biometric-profiles tx-sender)) err-biometric-already-registered)
      
      ;; Validate biometric data
      (asserts! (> (len biometric-hash) u0) err-invalid-biometric-data)
      (asserts! (> (len backup-hash) u0) err-invalid-biometric-data)
      
      ;; Register biometric profile
      (map-set biometric-profiles tx-sender {
        biometric-hash: biometric-hash,
        backup-hash: backup-hash,
        is-active: true,
        registration-id: registration-id,
        last-updated: u0,
        failed-attempts: u0,
        is-locked: false
      })
      
      ;; Create user profile
      (map-set user-profiles tx-sender {
        display-name: display-name,
        default-payment-limit: u10000000, ;; 10 STX default limit
        daily-spent: u0,
        last-reset-day: u0,
        is-verified: true,
        registration-date: u0
      })
      
      ;; Update counter
      (var-set biometric-counter registration-id)
      
      (ok registration-id))))

;; Update biometric data
(define-public (update-biometric (new-biometric-hash (buff 32)) (current-biometric-data (buff 64)))
  (match (map-get? biometric-profiles tx-sender)
    profile
      (let ((current-hash (hash-biometric-data current-biometric-data)))
        (begin
          ;; Verify current biometric
          (asserts! (verify-biometric-hash (get biometric-hash profile) current-hash) err-biometric-verification-failed)
          (asserts! (not (get is-locked profile)) err-unauthorized)
          
          ;; Update biometric hash
          (map-set biometric-profiles tx-sender (merge profile {
            biometric-hash: new-biometric-hash,
            last-updated: u0
          }))
          
          (ok true)))
    err-biometric-not-registered))

;; Register as merchant
(define-public (register-merchant (business-name (string-ascii 64)))
  (begin
    (map-set merchants tx-sender {
      business-name: business-name,
      is-verified: true,
      total-received: u0,
      transaction-count: u0
    })
    (ok true)))
;; Create payment request
(define-public (create-payment-request (payee principal) (amount uint) (description (string-ascii 128)) (requires-biometric bool))
  (let ((payment-id (+ (var-get payment-counter) u1))
        (expires-at (+ u0 (var-get authentication-timeout)))) ;; Simplified expiry
    (begin
      (asserts! (> amount u0) err-invalid-amount)
      (asserts! (is-biometric-registered tx-sender) err-biometric-not-registered)
      
      ;; Create payment request
      (map-set payment-requests payment-id {
        payer: tx-sender,
        payee: payee,
        amount: amount,
        description: description,
        status: "pending",
        created-at: u0,
        expires-at: expires-at,
        requires-biometric: requires-biometric,
        biometric-verified: false
      })
      
      ;; Update counter
      (var-set payment-counter payment-id)
      
      (ok payment-id))))
;; Authenticate with biometric data
(define-public (authenticate-payment (payment-id uint) (biometric-data (buff 64)))
  (match (map-get? payment-requests payment-id)
    payment-data
      (match (map-get? biometric-profiles (get payer payment-data))
        bio-profile
          (let ((provided-hash (hash-biometric-data biometric-data)))
            (begin
              ;; Check if account is locked
              (asserts! (not (get is-locked bio-profile)) err-unauthorized)
              
              ;; Check if payment expired
              (asserts! (not (is-payment-expired payment-id)) err-payment-expired)
              
              ;; Verify biometric
              (if (verify-biometric-hash (get biometric-hash bio-profile) provided-hash)
                (begin
                  ;; Reset failed attempts on successful auth
                  (reset-failed-attempts (get payer payment-data))
                  
                  ;; Mark payment as biometrically verified
                  (map-set payment-requests payment-id (merge payment-data {
                    biometric-verified: true
                  }))
                  
                  (ok true))
                (begin
                  ;; Increment failed attempts
                  (increment-failed-attempts (get payer payment-data))
                  err-biometric-verification-failed))))
        err-biometric-not-registered)
    err-payment-not-found))
;; Process authenticated payment
(define-public (process-biometric-payment (payment-id uint))
  (match (map-get? payment-requests payment-id)
    payment-data
      (let ((payer (get payer payment-data))
            (payee (get payee payment-data))
            (amount (get amount payment-data)))
        (begin
          ;; Verify caller is the payer
          (asserts! (is-eq tx-sender payer) err-unauthorized)
          
          ;; Check if payment is pending
          (asserts! (is-eq (get status payment-data) "pending") err-payment-already-processed)
          
          ;; Check biometric verification
          (asserts! (get biometric-verified payment-data) err-biometric-verification-failed)
          
          ;; Check if payment expired
          (asserts! (not (is-payment-expired payment-id)) err-payment-expired)
          
          ;; Check balance
          (asserts! (>= (stx-get-balance tx-sender) amount) err-insufficient-balance)
          
          ;; Check daily spending limit
          (match (map-get? user-profiles payer)
            profile
              (let ((new-daily-spent (+ (get daily-spent profile) amount)))
                (begin
                  (asserts! (<= new-daily-spent (get default-payment-limit profile)) (err u112))
                  
                  ;; Update daily spending
                  (map-set user-profiles payer (merge profile {
                    daily-spent: new-daily-spent
                  }))))
            true)
          
          ;; Process payment
          (try! (stx-transfer? amount tx-sender payee))
          
          ;; Update payment status
          (map-set payment-requests payment-id (merge payment-data {
            status: "completed"
          }))
          
          ;; Update merchant stats if payee is registered merchant
          (match (map-get? merchants payee)
            merchant-data
              (map-set merchants payee (merge merchant-data {
                total-received: (+ (get total-received merchant-data) amount),
                transaction-count: (+ (get transaction-count merchant-data) u1)
              }))
            true)
          
          (ok true)))
    err-payment-not-found))
;; Emergency backup authentication using backup hash
(define-public (backup-authenticate (payment-id uint) (backup-biometric-data (buff 64)))
  (match (map-get? payment-requests payment-id)
    payment-data
      (match (map-get? biometric-profiles (get payer payment-data))
        bio-profile
          (let ((backup-hash (hash-biometric-data backup-biometric-data)))
            (begin
              ;; Verify backup biometric
              (asserts! (verify-biometric-hash (get backup-hash bio-profile) backup-hash) err-biometric-verification-failed)
              
              ;; Unlock account and reset attempts
              (map-set biometric-profiles (get payer payment-data) (merge bio-profile {
                is-locked: false,
                failed-attempts: u0
              }))
              
              ;; Mark payment as verified
              (map-set payment-requests payment-id (merge payment-data {
                biometric-verified: true
              }))
              
              (ok true)))
        err-biometric-not-registered)
    err-payment-not-found))

;; Cancel payment request
(define-public (cancel-payment-request (payment-id uint))
  (match (map-get? payment-requests payment-id)
    payment-data
      (begin
        ;; Only payer or payee can cancel
        (asserts! (or (is-eq tx-sender (get payer payment-data)) 
                     (is-eq tx-sender (get payee payment-data))) err-unauthorized)
        
        ;; Update status
        (map-set payment-requests payment-id (merge payment-data {
          status: "cancelled"
        }))
        
        (ok true))
    err-payment-not-found))

;; Update daily spending limit
(define-public (update-spending-limit (new-limit uint))
  (match (map-get? user-profiles tx-sender)
    profile
      (begin
        (map-set user-profiles tx-sender (merge profile {
          default-payment-limit: new-limit
        }))
        (ok true))
    err-user-not-found))

;; Admin functions

;; Update authentication timeout (owner only)
(define-public (update-auth-timeout (new-timeout uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (var-set authentication-timeout new-timeout)
    (ok true)))

;; Update max retry attempts (owner only)
(define-public (update-max-retries (new-max uint))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (var-set max-retry-attempts new-max)
    (ok true)))

;; Unlock user account (owner only)
(define-public (unlock-user-account (user principal))
  (begin
    (asserts! (is-eq tx-sender contract-owner) err-owner-only)
    (match (map-get? biometric-profiles user)
      profile
        (begin
          (map-set biometric-profiles user (merge profile {
            is-locked: false,
            failed-attempts: u0
          }))
          (ok true))
      err-biometric-not-registered)))

;; Deactivate biometric profile (owner only or user)
(define-public (deactivate-biometric (user principal))
  (begin
    (asserts! (or (is-eq tx-sender contract-owner) (is-eq tx-sender user)) err-unauthorized)
    (match (map-get? biometric-profiles user)
      profile
        (begin
          (map-set biometric-profiles user (merge profile {
            is-active: false
          }))
          (ok true))
      err-biometric-not-registered)))

;; Get user statistics
(define-read-only (get-user-stats (user principal))
  (match (map-get? user-profiles user)
    profile
      (ok {
        display-name: (get display-name profile),
        daily-spent: (get daily-spent profile),
        spending-limit: (get default-payment-limit profile),
        is-verified: (get is-verified profile),
        is-biometric-active: (is-biometric-registered user)
      })
    err-user-not-found))

;; Get payment statistics
(define-read-only (get-payment-stats)
  (ok {
    total-payments: (var-get payment-counter),
    total-biometric-users: (var-get biometric-counter),
    auth-timeout: (var-get authentication-timeout)
  }))